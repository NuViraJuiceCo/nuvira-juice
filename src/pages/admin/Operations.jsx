import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Package,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  UsersRound,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import May30ReadinessPanel from '@/components/admin/May30ReadinessPanel';
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
      {
        title: 'POS / Event Orders',
        route: '/admin/pos-orders',
        description: 'Read-only Hub POS sales list with fulfillment, production, location, and item context.',
        icon: Store,
        badges: ['Read-only', 'Hub-backed', 'May 30 event'],
      },
      {
        title: 'Shopify',
        route: '/admin/shopify',
        description: 'Shopify order/POS bridge visibility, webhook status, and exact-order gated fallback context.',
        icon: ShoppingCart,
        badges: ['Read-only', 'Gated tools', 'Hub fallback'],
      },
      {
        title: 'Live Checkout Monitor',
        route: '/admin/live-monitor',
        description: 'One-order checkout trace visibility for app order smoke tests and bridge confirmation.',
        icon: Activity,
        badges: ['Read-only', 'Exact order'],
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
        description: 'Production batches by date with preview-first start, complete, verify, ingredient usage, task pack, and inventory preview controls.',
        icon: Package,
        badges: ['Controlled actions', 'Hub-backed', 'Preview-first'],
      },
      {
        title: 'Production Planning',
        route: '/admin/production-planning',
        description: 'Read-only ingredient demand and production planning coverage.',
        icon: CalendarDays,
        badges: ['Read-only', 'Hub-backed'],
      },
      {
        title: 'Inventory Status',
        route: '/admin/inventory-status',
        description: 'Read-only stock levels, reorder health, suppliers, and storage locations.',
        icon: Package,
        badges: ['Read-only', 'Hub-backed'],
      },
      {
        title: 'Compliance Ops',
        route: '/admin/compliance-ops',
        description: 'Native compliance forms, batch log visibility, audit packet export, and Hub fallback context.',
        icon: ShieldCheck,
        badges: ['Controlled writes', 'Native', 'May 30'],
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
        description: 'Delivery stops plus approved driver assignment, Out For Delivery, and operational Delivered actions.',
        icon: Truck,
        badges: ['Controlled actions', 'Hub-backed'],
      },
    ],
  },
  {
    title: 'Schedule',
    description: 'Calendar and event visibility',
    cards: [
      {
        title: 'Calendar',
        route: '/admin/calendar',
        description: 'Read-only operations schedule with events plus aggregate production and delivery day summaries.',
        icon: CalendarDays,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
  {
    title: 'Resources / Catalog',
    description: 'Team, equipment, and catalog controls',
    cards: [
      {
        title: 'Resources',
        route: '/admin/resources',
        description: 'Read-only team and equipment visibility from Hub resources.',
        icon: UsersRound,
        badges: ['Read-only', 'Hub-backed'],
      },
      {
        title: 'Product Images',
        route: '/admin/products',
        description: 'Admin product photo management for keeping the customer-facing catalog usable.',
        icon: Package,
        badges: ['Controlled actions', 'Native'],
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
      {
        title: 'Sync Health',
        route: '/admin/sync-health',
        description: 'Read-only bridge health with aggregate sync counts and sanitized error categories.',
        icon: Activity,
        badges: ['Read-only', 'Hub-backed'],
      },
    ],
  },
];

const may30ReadinessItems = [
  {
    label: 'One-time orders',
    status: 'ready',
    detail: 'Admin Orders shows Customer App plus Hub operational context, native review status, fulfillment tasks, timeline, and notes.',
  },
  {
    label: 'POS / event orders',
    status: 'ready',
    detail: 'POS/Event Orders separates event sales from delivery work and flags unexpected production, delivery, or task requirements.',
  },
  {
    label: 'Production operations',
    status: 'controlled',
    detail: 'Production Queue exposes preview-first Hub-backed lifecycle actions for eligible exact batches.',
  },
  {
    label: 'Ingredient / procurement',
    status: 'ready',
    detail: 'Production Planning and Inventory Status show recipe demand, make-to-order procurement needs, and missing master-data blockers.',
  },
  {
    label: 'Compliance',
    status: 'controlled',
    detail: 'Compliance Ops can create native logs and export audit packets; batch logs remain tied to production verification.',
  },
  {
    label: 'Delivery / fulfillment',
    status: 'controlled',
    detail: 'Delivery Queue supports driver assignment, Out For Delivery, Delivered, and route previews without customer notification expansion.',
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
    default: 'border-slate-300 bg-slate-100 text-slate-950 border-l-slate-600',
    info: 'border-sky-300 bg-sky-100 text-sky-950 border-l-sky-600',
    success: 'border-emerald-300 bg-emerald-100 text-emerald-950 border-l-emerald-600',
    warning: 'border-cyan-300 bg-cyan-100 text-cyan-950 border-l-cyan-500',
    danger: 'border-rose-300 bg-rose-100 text-rose-950 border-l-rose-600',
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
  const [appliedDateFrom, setAppliedDateFrom] = useState(addDays(today, -6));
  const [appliedDateTo, setAppliedDateTo] = useState(today);
  const isCustom = preset === 'custom';
  const rangeError = validateRange(dateFrom, dateTo);
  const requestDateFrom = isCustom ? appliedDateFrom : null;
  const requestDateTo = isCustom ? appliedDateTo : null;

  const queryKey = ['admin-operations-dashboard-summary', preset, requestDateFrom, requestDateTo];
  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey,
    queryFn: async () => {
      const payload = isCustom
        ? { preset: 'custom', date_from: appliedDateFrom, date_to: appliedDateTo }
        : { preset };
      const res = await base44.functions.invoke('getAdminOperationsDashboardSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {} };
    },
    enabled: user?.role === 'admin',
    staleTime: 60000,
  });

  const summary = data?.summary || {};
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(Boolean) : [];
  const isNativeFallback = data?.source === 'customer_app_native_operations_dashboard_fallback'
    || data?.data_sources?.hub_available === false;
  const showError = isError && !data && !isFetching;
  const contextLabel = useMemo(() => {
    if (isCustom) {
      const hasCurrentResponse = data?.date_from === appliedDateFrom && data?.date_to === appliedDateTo;
      const from = hasCurrentResponse ? data.date_from : appliedDateFrom;
      const to = hasCurrentResponse ? data.date_to : appliedDateTo;
      return `${formatDate(from)} - ${formatDate(to)}`;
    }
    if (data?.date_from && data?.date_to) {
      return `${formatDate(data.date_from)} - ${formatDate(data.date_to)}`;
    }
    const option = presetOptions.find(item => item.value === preset);
    return option?.label || 'Last 7 Days';
  }, [appliedDateFrom, appliedDateTo, data?.date_from, data?.date_to, isCustom, preset]);

  const allZero = [
    summary.orders?.total,
    summary.production?.batch_count,
    summary.delivery?.today_stops,
    summary.inventory?.low,
    summary.alerts?.active,
  ].every(value => Number(value || 0) === 0);

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-white">Operations Snapshot</h2>
            <span className="rounded-full border border-cyan-500 bg-cyan-600 px-2 py-0.5 text-[10px] font-black text-white">
              Read-only
            </span>
          </div>
          <p className="text-xs font-medium text-slate-300 mt-0.5">
            {isNativeFallback ? 'Native Customer App fallback summary' : 'Aggregate Hub summary'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Range</p>
          <p className="text-xs font-bold text-white">{contextLabel}</p>
          {data?.generated_at && (
            <p className="text-[10px] text-slate-400 mt-0.5">
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
            onClick={() => {
              setPreset(option.value);
            }}
            className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
              preset === option.value
                ? 'bg-emerald-500 text-emerald-950 border-emerald-400'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-emerald-500 hover:text-white'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Custom From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
            }}
            className="w-full h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Custom To</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
            }}
            className="w-full h-10 rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white"
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
                ? 'bg-emerald-500 text-emerald-950 border-emerald-400'
                : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-emerald-500 hover:text-white'
          }`}
        >
          Apply Range
        </button>
      </div>

      {rangeError && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
          {rangeError}
        </div>
      )}

      {showError && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">
          {error?.message || 'Unable to load operations snapshot.'}
        </div>
      )}

      {data?.truncated && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
          Some Hub source reads were capped. Counts are shown as a bounded operations summary.
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
          {warnings.includes('native_read_only_fallback')
            ? 'Hub dashboard aggregation is unavailable. Showing native Customer App read-only counts so operations stay visible.'
            : warnings.slice(0, 2).join(', ')}
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
          {allZero && !showError && (
            <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs font-medium text-slate-300">
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
  const lower = label.toLowerCase();
  const tone = lower.includes('hub')
    ? 'hub'
    : lower.includes('controlled') || lower.includes('write')
      ? 'warning'
      : lower.includes('may 30')
        ? 'source'
        : lower.includes('read-only')
          ? 'neutral'
          : 'neutral';
  return <AdminStatusPill label={label} tone={tone} />;
}

function cardVisibilityTone(title) {
  const key = title.toLowerCase();
  if (key.includes('order')) return { border: 'border-sky-500', gradient: 'from-sky-500 to-blue-700' };
  if (key.includes('pos') || key.includes('event')) return { border: 'border-fuchsia-500', gradient: 'from-fuchsia-500 to-purple-700' };
  if (key.includes('production')) return { border: 'border-lime-500', gradient: 'from-lime-500 to-emerald-700' };
  if (key.includes('inventory')) return { border: 'border-rose-500', gradient: 'from-rose-500 to-red-700' };
  if (key.includes('delivery')) return { border: 'border-emerald-500', gradient: 'from-emerald-500 to-green-700' };
  if (key.includes('calendar')) return { border: 'border-cyan-500', gradient: 'from-cyan-500 to-teal-700' };
  if (key.includes('resource')) return { border: 'border-indigo-500', gradient: 'from-indigo-500 to-blue-700' };
  if (key.includes('alert')) return { border: 'border-red-500', gradient: 'from-red-500 to-rose-700' };
  if (key.includes('sync')) return { border: 'border-violet-500', gradient: 'from-violet-500 to-indigo-700' };
  return { border: 'border-slate-600', gradient: 'from-slate-600 to-slate-800' };
}

function OperationCard({ card }) {
  const Icon = card.icon;
  const tone = cardVisibilityTone(card.title);

  return (
    <Link to={card.route} className="block">
      <div className={`group overflow-hidden rounded-xl border bg-card active:scale-[0.99] transition-all hover:-translate-y-0.5 hover:shadow-md ${tone.border}`}>
        <div className={`h-1.5 bg-gradient-to-r ${tone.gradient}`} />
        <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${tone.gradient} flex items-center justify-center shrink-0 shadow-sm`}>
            <Icon className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-sm font-black text-foreground">{card.title}</h3>
                <p className="text-xs font-medium text-muted-foreground mt-1 leading-relaxed">{card.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground/70 shrink-0 group-hover:translate-x-0.5 transition-transform" />
            </div>

            <div className="flex flex-wrap gap-1.5 mt-3">
              {card.badges.map(badge => (
                <Badge key={badge} label={badge} />
              ))}
            </div>
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
        <h2 className="text-sm font-black text-foreground">{section.title}</h2>
        <p className="text-xs font-medium text-muted-foreground mt-0.5">{section.description}</p>
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
      <AdminOpsHeader
        title="Operations"
        subtitle="Hub-backed admin tools"
        badge="Admin-only"
        badgeTone="native"
        backTo="/account"
        actions={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      />

      <div className="px-4 mt-4 space-y-5">
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950 p-3 shadow-sm">
          <p className="text-xs font-black text-white">Migrated Hub surfaces</p>
          <p className="text-[10px] font-medium text-emerald-100 mt-0.5">
            Navigation-only workspace for existing Customer App admin operations pages.
          </p>
          <AdminStatusLegend className="mt-2" />
        </div>

        <May30ReadinessPanel
          items={may30ReadinessItems}
          description="Launch-critical admin surfaces are visible here. Hub remains fallback where it is still the safest source of truth."
          footnote="Frozen for event day: native safeSync writer, refunds, broad repair/replay, inventory deduction automation, proof/drop, route save, bag credits, and customer-facing status notification expansion."
        />

        {sections.map(section => (
          <OperationSection key={section.title} section={section} />
        ))}

        <OperationsSnapshot user={user} />
      </div>
    </div>
  );
}
