import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Bell,
  ChevronRight,
  ClipboardList,
  Package,
  ShieldCheck,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
];

const sections = [
  {
    title: 'Orders',
    description: 'Order operations and Hub context',
    cards: [
      {
        title: 'Admin Orders',
        route: '/admin/orders',
        description: 'Order operations, Hub panels, fulfillment context, timeline visibility, and internal notes.',
        icon: ClipboardList,
        badges: ['Hub-backed', 'Internal note write available'],
      },
    ],
  },
  {
    title: 'Production',
    description: 'Production and stock visibility',
    cards: [
      {
        title: 'Production Queue',
        route: '/admin/production-queue',
        description: 'Read-only production batches and demand grouped by production date.',
        icon: Package,
        badges: ['Read-only', 'Hub-backed'],
      },
      {
        title: 'Inventory Status',
        route: '/admin/inventory-status',
        description: 'Read-only stock levels, reorder health, suppliers, and storage locations.',
        icon: Package,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
  {
    title: 'Delivery',
    description: 'Route and delivery visibility',
    cards: [
      {
        title: 'Delivery Queue',
        route: '/admin/delivery-queue',
        description: 'Read-only delivery stops, proof visibility, drop locations, and completed deliveries.',
        icon: Truck,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
  {
    title: 'Monitoring',
    description: 'Sanitized operations inbox',
    cards: [
      {
        title: 'Ops Alerts',
        route: '/admin/ops-alerts',
        description: 'Read-only sanitized operations alerts without raw payloads or alert actions.',
        icon: Bell,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
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

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
}

function SnapshotMetricCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    info: 'border-blue-100 bg-blue-50/60',
    success: 'border-emerald-100 bg-emerald-50/60',
    warning: 'border-amber-100 bg-amber-50/60',
    danger: 'border-red-100 bg-red-50/60',
  }[tone] || 'border-border/50 bg-card';

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold text-foreground">{formatNumber(value)}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function SnapshotGroup({ title, description, children }) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-bold text-foreground">{title}</h3>
        <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {children}
      </div>
    </section>
  );
}

function OperationsSnapshot({ user }) {
  const today = todayDate();
  const [preset, setPreset] = useState('last_7_days');
  const [dateFrom, setDateFrom] = useState(addDays(today, -6));
  const [dateTo, setDateTo] = useState(today);
  const isCustom = preset === 'custom';
  const rangeError = isCustom ? validateRange(dateFrom, dateTo) : null;

  const queryKey = ['admin-operations-dashboard-summary', preset, dateFrom, dateTo];
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = isCustom
        ? { preset: 'custom', date_from: dateFrom, date_to: dateTo }
        : { preset };
      const res = await base44.functions.invoke('getAdminOperationsDashboardSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {} };
    },
    enabled: user?.role === 'admin' && !rangeError,
    staleTime: 60000,
  });

  const summary = data?.summary || {};
  const contextLabel = useMemo(() => {
    if (data?.date_from && data?.date_to) {
      return `${formatDate(data.date_from)} - ${formatDate(data.date_to)}`;
    }
    if (isCustom) return `${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
    const option = presetOptions.find(item => item.value === preset);
    return option?.label || 'Last 7 Days';
  }, [data?.date_from, data?.date_to, dateFrom, dateTo, isCustom, preset]);

  const allZero = [
    summary.orders?.total,
    summary.production?.batch_count,
    summary.delivery?.today_stops,
    summary.inventory?.low,
    summary.alerts?.active,
  ].every(value => Number(value || 0) === 0);

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-foreground">Operations Snapshot</h2>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border/50">
              Read-only
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">Aggregate Hub summary</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Range</p>
          <p className="text-xs font-semibold text-foreground">{contextLabel}</p>
          {data?.generated_at && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Generated: {formatDateTime(data.generated_at)}
            </p>
          )}
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
            onChange={(event) => {
              setPreset('custom');
              setDateFrom(event.target.value);
            }}
            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setPreset('custom');
              setDateTo(event.target.value);
            }}
            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
          />
        </label>
      </div>

      {rangeError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {rangeError}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">
          {error?.message || 'Unable to load operations snapshot.'}
        </div>
      )}

      {data?.truncated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Some Hub source reads were capped. Counts are shown as a bounded operations summary.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="h-20 rounded-xl border border-border/50 bg-muted/40 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {allZero && !rangeError && !isError && (
            <div className="rounded-lg border border-border/50 bg-background p-3 text-xs text-muted-foreground">
              No aggregate activity found for this range.
            </div>
          )}

          <SnapshotGroup title="Orders" description="Date-scoped order state counts">
            <SnapshotMetricCard icon={ShoppingCart} label="Total" value={summary.orders?.total} isRefreshing={isFetching} />
            <SnapshotMetricCard label="Paid" value={summary.orders?.paid} />
            <SnapshotMetricCard label="Fulfilled" value={summary.orders?.fulfilled} tone="success" />
            <SnapshotMetricCard label="Delivered" value={summary.orders?.delivered} tone="success" />
          </SnapshotGroup>

          <SnapshotGroup title="Production" description="Aggregate batches and units">
            <SnapshotMetricCard icon={Package} label="Batches" value={summary.production?.batch_count} />
            <SnapshotMetricCard label="Planned Units" value={summary.production?.planned_units} />
            <SnapshotMetricCard label="Produced Units" value={summary.production?.produced_units} />
          </SnapshotGroup>

          <SnapshotGroup title="Delivery" description="Current route and completion totals">
            <SnapshotMetricCard icon={Truck} label="Today Stops" value={summary.delivery?.today_stops} />
            <SnapshotMetricCard label="Tomorrow Stops" value={summary.delivery?.tomorrow_stops} />
            <SnapshotMetricCard label="Completed In Range" value={summary.delivery?.completed_in_range} tone="success" />
          </SnapshotGroup>

          <SnapshotGroup title="Inventory" description="Inventory health counts">
            <SnapshotMetricCard icon={AlertTriangle} label="Low" value={summary.inventory?.low} tone="warning" />
            <SnapshotMetricCard label="Critical" value={summary.inventory?.critical} tone="danger" />
            <SnapshotMetricCard label="Out Of Stock" value={summary.inventory?.out_of_stock} tone="danger" />
          </SnapshotGroup>

          <SnapshotGroup title="Alerts" description="Active sanitized ops alerts">
            <SnapshotMetricCard icon={Bell} label="Active" value={summary.alerts?.active} />
            <SnapshotMetricCard label="Critical" value={summary.alerts?.critical} tone="danger" />
            <SnapshotMetricCard label="Warning" value={summary.alerts?.warning} tone="warning" />
            <SnapshotMetricCard label="Info" value={summary.alerts?.info} tone="info" />
          </SnapshotGroup>

          <SnapshotGroup title="Source Mix" description="Aggregate order source counts">
            <SnapshotMetricCard icon={BarChart3} label="One-Time" value={summary.source_mix?.one_time} />
            <SnapshotMetricCard label="Subscription" value={summary.source_mix?.subscription} />
            <SnapshotMetricCard label="POS" value={summary.source_mix?.pos} />
            <SnapshotMetricCard label="Other" value={summary.source_mix?.other} />
          </SnapshotGroup>
        </div>
      )}
    </section>
  );
}

function Badge({ label }) {
  const isWriteBadge = label.includes('write');
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
      isWriteBadge
        ? 'bg-amber-50 text-amber-800 border border-amber-200'
        : 'bg-secondary text-secondary-foreground border border-border/50'
    }`}>
      {label}
    </span>
  );
}

function OperationCard({ card }) {
  const Icon = card.icon;

  return (
    <Link to={card.route} className="block">
      <div className="group rounded-xl border border-border/50 bg-card p-4 active:scale-[0.99] transition-all hover:border-primary/30 hover:shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/15 dark:bg-primary/20 flex items-center justify-center shrink-0 border border-primary/20">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-foreground">{card.title}</h3>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{card.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {card.badges.map(badge => (
                <Badge key={badge} label={badge} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}

function OperationSection({ section }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">{section.title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{section.description}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {section.cards.map(card => (
          <OperationCard key={card.route} card={card} />
        ))}
      </div>
    </section>
  );
}

export default function Operations() {
  const { user } = useAuth();

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
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Operations</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Hub-backed admin tools</p>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full bg-white/20 text-white">
            <ShieldCheck className="w-3 h-3" />
            Admin-only
          </span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-5">
        <OperationsSnapshot user={user} />

        <div className="rounded-xl border border-border/50 bg-card p-3">
          <p className="text-xs font-semibold text-foreground">Migrated Hub surfaces</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Navigation-only workspace for existing Customer App admin operations pages.
          </p>
        </div>

        {sections.map(section => (
          <OperationSection key={section.title} section={section} />
        ))}
      </div>
    </div>
  );
}
