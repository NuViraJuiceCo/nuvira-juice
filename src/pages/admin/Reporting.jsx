import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { base44 } from '@/api/base44Client';
import { unwrapBase44Result } from '@/lib/base44-result';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { usePageVisibility } from '@/lib/usePageVisibility';
import { Activity, AlertTriangle, ArrowRight, BarChart3, Bell, CalendarDays, CheckCircle2, ClipboardList, Package, RefreshCw, ShieldCheck, Truck } from 'lucide-react';

const presets = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
];

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatDate(value) {
  if (!value) return 'Range pending';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function chicagoDate(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function StatCard({ icon: Icon, label, value, sublabel, route, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    success: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30',
    warning: 'border-cyan-200 bg-cyan-50/70 dark:border-cyan-900/60 dark:bg-cyan-950/30',
  }[tone] || 'border-border/50 bg-card';
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        {Icon && <Icon className={`h-4 w-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />}
        {route && <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </>
  );
  if (route) {
    return <Link to={route} className={`rounded-xl border p-3 transition-colors hover:border-emerald-500 ${toneClass}`}>{body}</Link>;
  }
  return <div className={`rounded-xl border p-3 ${toneClass}`}>{body}</div>;
}

function ReadinessCard({ title, detail, route, icon: Icon }) {
  return (
    <Link to={route} className="group rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-emerald-500">
      <div className="flex items-start justify-between gap-3">
        <Icon className="h-5 w-5 text-primary" />
        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>
      <h2 className="mt-3 text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    </Link>
  );
}

function backendReadinessTone(classification) {
  if (classification === 'backend_live_ready_readonly_clean') return 'success';
  if (classification === 'backend_readiness_blocked') return 'danger';
  return 'warning';
}

function BackendPreflightCard({ readiness, isFetching }) {
  const classification = readiness?.classification || 'backend_preflight_pending';
  const tone = backendReadinessTone(classification);
  const blockers = Number(readiness?.summary?.blocker_count || 0);
  const warnings = Number(readiness?.summary?.warning_count || 0);
  const issuePreview = Array.isArray(readiness?.issues) ? readiness.issues.slice(0, 3) : [];
  const toneClass = {
    success: 'border-emerald-300 bg-emerald-50/80 text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-100',
    warning: 'border-cyan-300 bg-cyan-50/80 text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100',
    danger: 'border-rose-300 bg-rose-50/80 text-rose-950 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-100',
  }[tone];
  const Icon = tone === 'success' ? CheckCircle2 : AlertTriangle;

  return (
    <section className={`rounded-xl border p-4 ${toneClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${isFetching ? 'animate-pulse' : ''}`} />
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider opacity-75">Backend Live Preflight</p>
            <h2 className="mt-1 text-base font-black">
              {blockers > 0
                ? `${blockers} blocker${blockers === 1 ? '' : 's'} before live test`
                : warnings > 0 ? `${warnings} warning${warnings === 1 ? '' : 's'} to review` : 'No backend blockers detected'}
            </h2>
            <p className="mt-1 text-xs font-semibold opacity-80">
              Read-only reconciliation across production, compliance, fulfillment, order sync, command logs, and notification campaigns.
            </p>
          </div>
        </div>
        <div className="rounded-lg border border-current/20 px-3 py-2 text-right">
          <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Classification</p>
          <p className="text-xs font-black">{classification.replace(/_/g, ' ')}</p>
        </div>
      </div>
      {issuePreview.length > 0 && (
        <div className="mt-3 grid gap-2 lg:grid-cols-3">
          {issuePreview.map((item, index) => (
            <div key={`${item.code}-${index}`} className="rounded-lg border border-current/20 bg-background/40 p-3">
              <p className="text-[10px] font-black uppercase tracking-wider opacity-70">{item.domain?.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-xs font-bold">{item.code?.replace(/_/g, ' ')}</p>
              {item.display_id && <p className="mt-1 text-[10px] opacity-75">{item.display_id}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function Reporting() {
  const { user } = useAuth();
  const isPageVisible = usePageVisibility();
  const [preset, setPreset] = useState('today');

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-reporting-operations-summary', preset],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminOperationsDashboardSummary', { preset });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result || { summary: {} };
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const { data: backendReadiness, isFetching: isBackendReadinessFetching } = useQuery({
    queryKey: ['admin-reporting-backend-readiness-preflight'],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminOperationsDashboardSummary', {
        include_backend_readiness: true,
        date_from: chicagoDate(-7),
        date_to: chicagoDate(7),
      });
      const result = unwrapBase44Result(res);
      if (result?.error || result?.error_code) throw new Error(result.message || result.error || result.error_code);
      return result?.backend_readiness || null;
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const summary = data?.summary || {};
  const delivery = summary.delivery || {};
  const production = summary.production || {};
  const orders = summary.orders || {};
  const alerts = summary.alerts || {};
  const sourceMix = summary.source_mix || {};
  const inventory = summary.inventory || {};
  const range = data?.date_from && data?.date_to ? `${formatDate(data.date_from)} - ${formatDate(data.date_to)}` : presets.find(item => item.value === preset)?.label;

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader title="Reporting" subtitle="Live operations readout" badge="Read-only" />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reporting Range</p>
              <h2 className="mt-1 text-base font-bold text-foreground">{range}</h2>
              <p className="mt-1 text-xs text-muted-foreground">Live read-only dashboard; no exports, emails, repairs, syncs, or provider calls are triggered here.</p>
            </div>
            <RefreshCw className={`h-4 w-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {presets.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreset(option.value)}
                className={`h-9 rounded-lg border px-3 text-xs font-semibold ${
                  preset === option.value
                    ? 'border-primary bg-nuvira-gradient text-white'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>

        <BackendPreflightCard readiness={backendReadiness} isFetching={isBackendReadinessFetching} />

        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl border border-border bg-muted/40" />)}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load reporting summary</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message || 'Try again later.'}</p>
          </div>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatCard icon={ClipboardList} label="Orders" value={formatNumber(orders.total)} sublabel={`${formatNumber(orders.paid)} paid`} route="/admin/orders" />
              <StatCard icon={Package} label="Production" value={`${formatNumber(production.planned_units)} units`} sublabel={`${formatNumber(production.batch_count)} batches`} route="/admin/production-queue" tone={Number(production.batch_count || 0) > 0 ? 'success' : 'default'} />
              <StatCard icon={Truck} label="Delivery" value={formatNumber(delivery.today_stops)} sublabel={`${formatNumber(delivery.unscheduled)} unscheduled`} route="/admin/route-ops" tone={Number(delivery.unscheduled || 0) > 0 ? 'warning' : 'default'} />
              <StatCard icon={Bell} label="Alerts" value={formatNumber(alerts.active)} sublabel={`${formatNumber(alerts.critical)} critical`} route="/admin/ops-alerts" tone={Number(alerts.active || 0) > 0 ? 'warning' : 'success'} />
            </section>

            <section className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <StatCard icon={BarChart3} label="One-time" value={formatNumber(sourceMix.one_time)} />
              <StatCard icon={BarChart3} label="Subscription" value={formatNumber(sourceMix.subscription)} />
              <StatCard icon={BarChart3} label="POS" value={formatNumber(sourceMix.pos)} route="/admin/pos-orders" />
              <StatCard icon={Activity} label="Inventory Diagnostics" value={formatNumber((inventory.low || 0) + (inventory.critical || 0) + (inventory.out_of_stock || 0))} route="/admin/inventory-status" />
            </section>

            <section className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <ReadinessCard icon={ShieldCheck} title="Compliance Packet" detail="Batch-linked logs, retroactive records, and audit packet visibility live in Compliance Ops." route="/admin/compliance-ops" />
              <ReadinessCard icon={CalendarDays} title="Schedule Context" detail="Calendar combines event, production, delivery, and compliance day summaries." route="/admin/calendar" />
              <ReadinessCard icon={BarChart3} title="Bridge Health" detail="Use Sync Health for sanitized source bridge status and migration diagnostics." route="/admin/sync-health" />
            </section>
          </>
        )}
      </main>
    </div>
  );
}
