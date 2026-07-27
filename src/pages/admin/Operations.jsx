import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  ClipboardList,
  Gift,
  Map,
  Package,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Truck,
  UsersRound,
} from 'lucide-react';
import { AdminStatusLegend } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { unwrapBase44Result } from '@/lib/base44-result';
import { usePageVisibility } from '@/lib/usePageVisibility';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
];

const sections = [
  {
    title: 'Orders',
    description: 'Order operations and fulfillment context',
    cards: [
      {
        title: 'Admin Orders',
        route: '/admin/orders',
        description: 'Order operations, fulfillment context, timeline visibility, and internal notes.',
        icon: ClipboardList,
        badges: ['Live source', 'Internal notes'],
      },
      {
        title: 'POS / Event Orders',
        route: '/admin/pos-orders',
        description: 'POS sales list with fulfillment, production, location, and item context.',
        icon: Store,
        badges: ['Live source', 'Events'],
      },
      {
        title: 'Shopify',
        route: '/admin/shopify',
        description: 'Shopify order/POS bridge visibility, webhook status, and exact-order gated source context.',
        icon: ShoppingCart,
        badges: ['Read-only', 'Gated tools', 'Source fallback'],
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
        description: 'Production batches by date with guided start, complete, verify, ingredient usage, task pack, and inventory checks.',
        icon: Package,
        badges: ['Live workflow', 'Batch-linked', 'Live source'],
      },
      {
        title: 'Production Planning',
        route: '/admin/production-planning',
        description: 'Ingredient demand and production planning coverage.',
        icon: CalendarDays,
        badges: ['Live planning', 'Live source'],
      },
      {
        title: 'Inventory Status',
        route: '/admin/inventory-status',
        description: 'Read-only stock levels, reorder health, suppliers, and storage locations.',
        icon: Package,
        badges: ['Read-only', 'Source-backed'],
      },
      {
        title: 'Compliance Ops',
        route: '/admin/compliance-ops',
        description: 'Native compliance forms, batch log visibility, audit packet export, and fallback context when needed.',
        icon: ShieldCheck,
        badges: ['Live forms', 'Batch-linked', 'Native'],
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
        badges: ['Live workflow', 'Live source'],
      },
      {
        title: 'Route Ops',
        route: '/admin/route-ops',
        description: 'Route review, date-pending delivery visibility, and driver-route readiness before using delivery actions.',
        icon: Map,
        badges: ['Live review', 'Route review'],
      },
      {
        title: 'Bag Returns',
        route: '/admin/bag-returns',
        description: 'Bag return credits and reusable tote accountability tied to customer/order context.',
        icon: ShoppingBag,
        badges: ['Protected workflow', 'Native'],
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
        description: 'Operations schedule with events plus aggregate production and delivery day summaries.',
        icon: CalendarDays,
        badges: ['Live schedule', 'Live source'],
      },
      {
        title: 'Events',
        route: '/admin/events',
        description: 'Event plan with dates, locations, capacity, ticket links, POS context, and production handoff.',
        icon: CalendarDays,
        badges: ['Live source', 'Events'],
      },
    ],
  },
  {
    title: 'Resources / Procurement / Catalog',
    description: 'Team, equipment, supplier, procurement, and catalog controls',
    cards: [
      {
        title: 'Resources',
        route: '/admin/resources',
        description: 'Read-only team and equipment visibility from source resources.',
        icon: UsersRound,
        badges: ['Read-only', 'Source-backed'],
      },
      {
        title: 'Suppliers',
        route: '/admin/suppliers',
        description: 'Read-only supplier directory with category, contact, terms, lead time, and status context.',
        icon: Store,
        badges: ['Read-only', 'Procurement'],
      },
      {
        title: 'Purchase Orders',
        route: '/admin/purchase-orders',
        description: 'Read-only open PO and procurement-line visibility for production planning.',
        icon: ClipboardList,
        badges: ['Read-only', 'Procurement'],
      },
      {
        title: 'Product Images',
        route: '/admin/products',
        description: 'Admin product photo management for keeping the customer-facing catalog usable.',
        icon: Package,
        badges: ['Live catalog', 'Native'],
      },
      {
        title: 'Loyalty Members',
        route: '/admin/loyalty-members',
        description: 'Loyalty member status, rewards visibility, referral context, and account health.',
        icon: Gift,
        badges: ['Read-only', 'Native'],
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
        badges: ['Read-only', 'Source-backed'],
      },
      {
        title: 'Review Queue',
        route: '/admin/review-queue',
        description: 'Read-only order/refund/reconciliation review inbox without repair, replay, sync, or notification actions.',
        icon: ShieldCheck,
        badges: ['Read-only', 'Review'],
      },
      {
        title: 'Reporting',
        route: '/admin/reporting',
        description: 'Live read-only operations readout for orders, production, delivery, source mix, alerts, and readiness links.',
        icon: BarChart3,
        badges: ['Read-only', '30s refresh'],
      },
      {
        title: 'Audit Trail',
        route: '/admin/audit-trail',
        description: 'Read-only command history with safe metadata and hidden raw payload/result bodies.',
        icon: ClipboardList,
        badges: ['Read-only', 'Audit'],
      },
      {
        title: 'Sync Health',
        route: '/admin/sync-health',
        description: 'Read-only bridge health with aggregate sync counts and sanitized error categories.',
        icon: Activity,
        badges: ['Read-only', 'Source-backed'],
      },
      {
        title: 'Sync Status',
        route: '/admin/sync-status',
        description: 'Current order-sync status guidance with a direct path into the full Sync Health console.',
        icon: BarChart3,
        badges: ['Read-only', 'Native'],
      },
      {
        title: 'Notifications',
        route: '/admin/notifications',
        description: 'Customer notification campaigns, test sends, and campaign send controls.',
        icon: Bell,
        badges: ['Live campaigns', 'Native'],
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

function compactLabel(value) {
  const text = (value || '').toString().trim();
  if (!text) return 'Not recorded';
  return text
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function topCountEntries(map = {}, limit = 3) {
  return Object.entries(map || {})
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

function inventoryDiagnosticCount(inventory = {}) {
  return Number(inventory.low || 0)
    + Number(inventory.critical || 0)
    + Number(inventory.out_of_stock || 0);
}

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
}

function readableWarning(value) {
  const warning = (value || '').toString();
  if (warning === 'native_read_only_fallback') {
    return 'Primary dashboard aggregation is unavailable. Showing native Customer App read-only counts so operations stay visible.';
  }
  if (warning === 'delivery_completed_in_range_uses_g39d_route_date_semantic') {
    return 'Completed delivery counts use route-date semantics for operational planning.';
  }
  if (warning === 'delivered_at_is_audit_only_not_bucket') {
    return 'Delivered-at timestamps are kept as audit evidence, not the date-bucket source.';
  }
  if (warning === 'native_production_queue_overlay_applied') {
    return 'Today production uses native Customer App batch totals because primary aggregation did not include those batches yet.';
  }
  if (warning === 'native_unscheduled_delivery_overlay_applied') {
    return 'Unscheduled delivery work is elevated from native Customer App orders because primary aggregation did not include those rows yet.';
  }
  if (warning === 'native_current_ops_health_overlay_applied') {
    return 'Open review items and recent command health are shown from the Customer App admin records.';
  }
  return warning
    .split('_')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function SnapshotMetricCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-slate-300 bg-slate-100 text-slate-950 border-l-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:border-l-slate-500',
    info: 'border-sky-300 bg-sky-100 text-sky-950 border-l-sky-600 dark:border-sky-900/70 dark:bg-sky-950/50 dark:text-sky-100 dark:border-l-sky-400',
    success: 'border-emerald-300 bg-emerald-100 text-emerald-950 border-l-emerald-600 dark:border-emerald-900/70 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-l-emerald-400',
    warning: 'border-cyan-300 bg-cyan-100 text-cyan-950 border-l-cyan-500 dark:border-cyan-900/70 dark:bg-cyan-950/50 dark:text-cyan-100 dark:border-l-cyan-300',
    danger: 'border-rose-300 bg-rose-100 text-rose-950 border-l-rose-600 dark:border-rose-900/70 dark:bg-rose-950/50 dark:text-rose-100 dark:border-l-rose-400',
  }[tone] || 'border-slate-300 bg-slate-100 text-slate-950 border-l-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:border-l-slate-500';

  return (
    <div className={`rounded-xl border border-l-4 p-3 shadow-sm ${toneClass}`}>
      {Icon && <Icon className={`w-4 h-4 mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider font-black opacity-75">{label}</p>
      <p className="text-xl font-black">{formatNumber(value)}</p>
      {sublabel && <p className="text-[10px] font-semibold opacity-75">{sublabel}</p>}
    </div>
  );
}

function DataNotes({ data, warnings }) {
  const notes = [];
  if (data?.truncated) {
    notes.push('Some source reads were capped. Counts are shown as a bounded operations summary.');
  }
  warnings.slice(0, 3).map(readableWarning).forEach(note => notes.push(note));
  if (notes.length === 0) return null;

  return (
    <details className="rounded-lg border border-cyan-900/70 bg-cyan-950/35 text-cyan-100">
      <summary className="cursor-pointer px-3 py-2 text-xs font-black uppercase tracking-wider">
        Data notes ({notes.length})
      </summary>
      <div className="space-y-2 border-t border-cyan-900/70 px-3 py-2 text-xs font-medium leading-snug text-cyan-100/85">
        {notes.map((note, index) => (
          <p key={`${note}-${index}`}>{note}</p>
        ))}
      </div>
    </details>
  );
}

function buildTodayRunway(summary) {
  const production = summary.production || {};
  const delivery = summary.delivery || {};
  const alerts = summary.alerts || {};
  const opsHealth = summary.ops_health || {};
  const inventory = summary.inventory || {};
  const plannedUnits = Number(production.planned_units || 0);
  const batchCount = Number(production.batch_count || 0);
  const todayStops = Number(delivery.today_stops || 0);
  const tomorrowStops = Number(delivery.tomorrow_stops || 0);
  const unscheduledStops = Number(delivery.unscheduled || 0);
  const activeAlerts = Number(alerts.active || 0);
  const opsIssueCount = Number(opsHealth.review_open || 0) + Number(opsHealth.command_failed || 0) + Number(opsHealth.command_rejected || 0) + Number(opsHealth.command_running || 0);
  const inventoryDiagnostics = inventoryDiagnosticCount(inventory);

  if (plannedUnits === 0 && batchCount === 0 && todayStops === 0 && tomorrowStops === 0 && unscheduledStops === 0 && activeAlerts === 0 && opsIssueCount === 0 && inventoryDiagnostics === 0) {
    return [];
  }

  return [
    {
      label: 'Produce',
      value: plannedUnits > 0 ? `${formatNumber(plannedUnits)} units` : `${formatNumber(batchCount)} batches`,
      detail: batchCount > 0 ? `${formatNumber(batchCount)} batch${batchCount === 1 ? '' : 'es'} ready to work` : 'No batches in range',
      route: '/admin/production-queue',
      icon: Package,
      tone: batchCount > 0 ? 'success' : 'default',
    },
    {
      label: 'Log Compliance',
      value: batchCount > 0 ? 'Batch-linked' : 'Ready',
      detail: batchCount > 0 ? 'Pre-op sanitation, checklist, and temp logs attach from production.' : 'Open compliance center for standalone logs.',
      route: batchCount > 0 ? '/admin/production-queue' : '/admin/compliance-ops',
      icon: ShieldCheck,
      tone: 'info',
    },
    {
      label: 'Fulfill',
      value: unscheduledStops > 0 ? `${formatNumber(unscheduledStops)} unscheduled` : todayStops > 0 ? `${formatNumber(todayStops)} today` : `${formatNumber(tomorrowStops)} tomorrow`,
      detail: unscheduledStops > 0
        ? 'Delivery work exists without a route date. Open the delivery queue before planning routes.'
        : todayStops > 0 || tomorrowStops > 0
          ? 'Route proof and delivery status read from the delivery queue.'
          : 'No delivery stops surfaced for this range.',
      route: '/admin/delivery-queue',
      icon: Truck,
      tone: unscheduledStops > 0 ? 'warning' : todayStops > 0 ? 'success' : 'default',
    },
    {
      label: 'Monitor',
      value: opsIssueCount > 0 ? `${formatNumber(opsIssueCount)} ops items` : activeAlerts > 0 ? `${formatNumber(activeAlerts)} alerts` : inventoryDiagnostics > 0 ? 'Inventory setup' : 'Clear',
      detail: opsIssueCount > 0
        ? 'Open review items or command records need operator review.'
        : activeAlerts > 0
          ? 'Review sanitized ops alerts.'
          : inventoryDiagnostics > 0
            ? `${formatNumber(inventoryDiagnostics)} stock reference rows need cleanup before counts are authoritative.`
            : 'No active alerts in this snapshot.',
      route: opsIssueCount > 0
        ? (Number(opsHealth.review_open || 0) > 0 ? '/admin/review-queue' : '/admin/audit-trail')
        : activeAlerts > 0
          ? '/admin/ops-alerts'
          : inventoryDiagnostics > 0
            ? '/admin/inventory-status'
            : '/admin/notifications',
      icon: activeAlerts > 0 ? Bell : Activity,
      tone: opsIssueCount > 0 || activeAlerts > 0 ? 'warning' : inventoryDiagnostics > 0 ? 'info' : 'success',
    },
  ];
}

function inventoryActionDetail(inventory) {
  const critical = Number(inventory.critical || 0);
  const low = Number(inventory.low || 0);
  const out = Number(inventory.out_of_stock || 0);
  const parts = [
    critical > 0 ? `${formatNumber(critical)} critical` : null,
    low > 0 ? `${formatNumber(low)} low` : null,
    out > 0 ? `${formatNumber(out)} out` : null,
  ].filter(Boolean);
  return `${parts.join(' · ')} reference row${parts.length === 1 ? '' : 's'} · diagnostic until stock policy is approved`;
}

function TodayRunway({ summary }) {
  const steps = buildTodayRunway(summary);
  if (steps.length === 0) return null;

  const toneClass = {
    default: 'border-slate-700 bg-slate-900 text-slate-100',
    info: 'border-sky-800 bg-sky-950/55 text-sky-100',
    success: 'border-emerald-800 bg-emerald-950/55 text-emerald-100',
    warning: 'border-cyan-800 bg-cyan-950/55 text-cyan-100',
  };

  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-xs font-bold text-white">Today's Run</h3>
        <p className="mt-0.5 text-[10px] text-slate-400">The working order for production, compliance, fulfillment, and monitoring.</p>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <Link
              key={step.label}
              to={step.route}
              className={`group rounded-xl border p-3 transition-colors hover:border-emerald-500 ${toneClass[step.tone] || toneClass.default}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-wider opacity-70">Step {index + 1}</p>
                  <p className="mt-1 text-sm font-black leading-tight">{step.label}</p>
                </div>
                <Icon className="h-4 w-4 shrink-0 opacity-75" />
              </div>
              <p className="mt-3 text-lg font-black">{step.value}</p>
              <p className="mt-1 text-[11px] font-semibold leading-snug opacity-75">{step.detail}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function PulseCard({ label, value, detail, route, icon: Icon, tone = 'default' }) {
  const toneClass = {
    default: 'border-slate-700 bg-slate-900 text-slate-100',
    success: 'border-emerald-800 bg-emerald-950/55 text-emerald-100',
    warning: 'border-cyan-800 bg-cyan-950/55 text-cyan-100',
    danger: 'border-rose-800 bg-rose-950/55 text-rose-100',
  }[tone] || 'border-slate-700 bg-slate-900 text-slate-100';

  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-wider opacity-70">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 opacity-75" />}
      </div>
      <p className="mt-2 text-2xl font-black leading-none">{value}</p>
      <p className="mt-2 text-[11px] font-semibold leading-snug opacity-75">{detail}</p>
    </>
  );

  if (!route) {
    return <div className={`rounded-xl border p-3 ${toneClass}`}>{content}</div>;
  }

  return (
    <Link to={route} className={`group rounded-xl border p-3 transition-colors hover:border-emerald-500 ${toneClass}`}>
      {content}
      <div className="mt-3 flex justify-end">
        <ArrowRight className="h-4 w-4 opacity-70 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function OperationsPulse({ summary }) {
  const orders = summary.orders || {};
  const production = summary.production || {};
  const delivery = summary.delivery || {};
  const alerts = summary.alerts || {};
  const inventory = summary.inventory || {};
  const opsHealth = summary.ops_health || {};
  const inventoryDiagnostics = inventoryDiagnosticCount(inventory);
  const activeAlerts = Number(alerts.active || 0);
  const unscheduledStops = Number(delivery.unscheduled || 0);
  const openReview = Number(opsHealth.review_open || 0);
  const commandIssues = Number(opsHealth.command_failed || 0) + Number(opsHealth.command_rejected || 0) + Number(opsHealth.command_running || 0);
  const exceptionCount = activeAlerts + unscheduledStops + openReview + commandIssues;

  return (
    <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
      <PulseCard
        label="Production"
        value={`${formatNumber(production.planned_units)} planned`}
        detail={`${formatNumber(production.batch_count)} batch${Number(production.batch_count) === 1 ? '' : 'es'} · ${formatNumber(production.produced_units)} produced`}
        route="/admin/production-queue"
        icon={Package}
        tone={Number(production.batch_count || 0) > 0 ? 'success' : 'default'}
      />
      <PulseCard
        label="Compliance"
        value={Number(production.batch_count || 0) > 0 ? 'Batch-linked' : 'Ready'}
        detail={Number(production.batch_count || 0) > 0 ? 'Pre-op, daily checklist, and temp logs attach from the production flow.' : 'Open compliance ops for standalone or retroactive logs.'}
        route={Number(production.batch_count || 0) > 0 ? '/admin/production-queue' : '/admin/compliance-ops'}
        icon={ShieldCheck}
        tone="success"
      />
      <PulseCard
        label="Fulfillment"
        value={unscheduledStops > 0 ? `${formatNumber(unscheduledStops)} unscheduled` : `${formatNumber(delivery.today_stops)} today`}
        detail={`${formatNumber(delivery.tomorrow_stops)} tomorrow · ${formatNumber(delivery.completed_in_range)} completed in range`}
        route="/admin/delivery-queue"
        icon={Truck}
        tone={unscheduledStops > 0 ? 'warning' : Number(delivery.today_stops || 0) > 0 ? 'success' : 'default'}
      />
      <PulseCard
        label="Watchlist"
        value={exceptionCount > 0 ? formatNumber(exceptionCount) : 'Clear'}
        detail={exceptionCount > 0
          ? `${formatNumber(unscheduledStops)} unscheduled delivery · ${formatNumber(openReview)} review · ${formatNumber(commandIssues)} command · ${formatNumber(activeAlerts)} alerts`
          : inventoryDiagnostics > 0
            ? `${formatNumber(orders.total)} orders · inventory reference setup still open`
            : `${formatNumber(orders.total)} orders in this range · no active alerts`}
        route={exceptionCount > 0
          ? (unscheduledStops > 0 ? '/admin/delivery-queue' : openReview > 0 ? '/admin/review-queue' : commandIssues > 0 ? '/admin/audit-trail' : '/admin/ops-alerts')
          : inventoryDiagnostics > 0 ? '/admin/inventory-status' : '/admin/orders'}
        icon={exceptionCount > 0 ? AlertTriangle : Activity}
        tone={exceptionCount > 0 ? 'warning' : 'success'}
      />
    </section>
  );
}

function OpsHealthContext({ summary }) {
  const details = summary.ops_health_details || {};
  const review = details.review_queue || {};
  const openReview = Number(review.open || 0);
  if (openReview <= 0) return null;

  const incidentEntries = topCountEntries(review.by_incident_type);
  const sourceEntries = topCountEntries(review.by_source);
  const ageText = review.oldest_open_at || review.newest_open_at
    ? `${formatDateTime(review.oldest_open_at) || 'Unknown'} - ${formatDateTime(review.newest_open_at) || 'Unknown'}`
    : 'No timestamp window';

  return (
    <section className="rounded-xl border border-cyan-800 bg-cyan-950/40 p-3 text-cyan-50">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-200/80">Review Queue Context</p>
          <h3 className="mt-1 text-sm font-black">{formatNumber(openReview)} open native review hold{openReview === 1 ? '' : 's'}</h3>
          <p className="mt-1 max-w-2xl text-xs font-medium leading-snug text-cyan-100/80">
            These are review holds, not active delivery stops. Use the read-only queue to decide which exact repair or archive path is appropriate.
          </p>
        </div>
        <Link
          to="/admin/review-queue"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-cyan-500 bg-cyan-600 px-3 text-xs font-black text-white hover:bg-cyan-500"
        >
          Open Queue
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-4">
        <div className="rounded-lg border border-cyan-800/80 bg-slate-950/55 p-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-200/75">Top Issues</p>
          <p className="mt-1 text-xs font-bold text-cyan-50">
            {incidentEntries.length > 0
              ? incidentEntries.map(([key, value]) => `${formatNumber(value)} ${compactLabel(key)}`).join(' · ')
              : 'No issue breakdown'}
          </p>
        </div>
        <div className="rounded-lg border border-cyan-800/80 bg-slate-950/55 p-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-200/75">Sources</p>
          <p className="mt-1 text-xs font-bold text-cyan-50">
            {sourceEntries.length > 0
              ? sourceEntries.map(([key, value]) => `${formatNumber(value)} ${compactLabel(key)}`).join(' · ')
              : 'No source breakdown'}
          </p>
        </div>
        <div className="rounded-lg border border-cyan-800/80 bg-slate-950/55 p-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-200/75">Order Linkage</p>
          <p className="mt-1 text-xs font-bold text-cyan-50">
            {formatNumber(review.has_order_number)} linked · {formatNumber(review.missing_order_number)} missing number
          </p>
        </div>
        <div className="rounded-lg border border-cyan-800/80 bg-slate-950/55 p-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-cyan-200/75">Age Window</p>
          <p className="mt-1 text-xs font-bold text-cyan-50">{ageText}</p>
        </div>
      </div>
    </section>
  );
}

function buildPriorityActions(summary) {
  const actions = [];
  const alerts = summary.alerts || {};
  const delivery = summary.delivery || {};
  const production = summary.production || {};
  const inventory = summary.inventory || {};
  const orders = summary.orders || {};
  const opsHealth = summary.ops_health || {};

  if (Number(delivery.unscheduled || 0) > 0) {
    actions.push({
      label: 'Schedule Delivery Work',
      detail: `${formatNumber(delivery.unscheduled)} paid delivery item${Number(delivery.unscheduled) === 1 ? '' : 's'} without route date`,
      route: '/admin/delivery-queue',
      tone: 'warning',
    });
  }

  if (Number(alerts.critical || 0) > 0) {
    actions.push({
      label: 'Review Critical Alerts',
      detail: `${formatNumber(alerts.critical)} critical alert${Number(alerts.critical) === 1 ? '' : 's'}`,
      route: '/admin/ops-alerts',
      tone: 'danger',
    });
  }

  if (Number(opsHealth.review_open || 0) > 0) {
    actions.push({
      label: 'Resolve Review Queue',
      detail: `${formatNumber(opsHealth.review_open)} open review item${Number(opsHealth.review_open) === 1 ? '' : 's'}`,
      route: '/admin/review-queue',
      tone: 'warning',
    });
  }

  const commandIssues = Number(opsHealth.command_failed || 0) + Number(opsHealth.command_rejected || 0) + Number(opsHealth.command_running || 0);
  if (commandIssues > 0) {
    actions.push({
      label: 'Check Command History',
      detail: `${formatNumber(opsHealth.command_failed)} failed · ${formatNumber(opsHealth.command_rejected)} rejected · ${formatNumber(opsHealth.command_running)} pending/running`,
      route: '/admin/audit-trail',
      tone: Number(opsHealth.command_failed || 0) > 0 ? 'danger' : 'warning',
    });
  }

  if (Number(delivery.today_stops || 0) > 0 || Number(delivery.tomorrow_stops || 0) > 0) {
    actions.push({
      label: 'Open Delivery Queue',
      detail: `${formatNumber(delivery.today_stops)} today · ${formatNumber(delivery.tomorrow_stops)} tomorrow`,
      route: '/admin/delivery-queue',
      tone: 'success',
    });
  }

  if (Number(production.batch_count || 0) > 0) {
    actions.push({
      label: 'Check Production Queue',
      detail: `${formatNumber(production.batch_count)} batch${Number(production.batch_count) === 1 ? '' : 'es'} in range`,
      route: '/admin/production-queue',
      tone: 'info',
    });
  }

  if (inventoryDiagnosticCount(inventory) > 0) {
    actions.push({
      label: 'Review Inventory Setup',
      detail: inventoryActionDetail(inventory),
      route: '/admin/inventory-status',
      tone: 'info',
    });
  }

  if (actions.length < 4 && Number(orders.total || 0) > 0) {
    actions.push({
      label: 'Review Orders',
      detail: `${formatNumber(orders.total)} order${Number(orders.total) === 1 ? '' : 's'} in range`,
      route: '/admin/orders',
      tone: 'default',
    });
  }

  return actions.slice(0, 4);
}

function PriorityAction({ action }) {
  const toneClass = {
    default: 'border-slate-700 bg-slate-900 text-slate-100',
    info: 'border-sky-800 bg-sky-950/60 text-sky-100',
    success: 'border-emerald-800 bg-emerald-950/60 text-emerald-100',
    warning: 'border-cyan-800 bg-cyan-950/60 text-cyan-100',
    danger: 'border-rose-800 bg-rose-950/60 text-rose-100',
  }[action.tone] || 'border-slate-700 bg-slate-900 text-slate-100';

  return (
    <Link
      to={action.route}
      className={`group flex min-h-[72px] items-center justify-between gap-3 rounded-xl border p-3 transition-colors hover:border-emerald-500 ${toneClass}`}
    >
      <div className="min-w-0">
        <p className="text-sm font-black leading-tight">{action.label}</p>
        <p className="mt-1 text-[11px] font-semibold opacity-75">{action.detail}</p>
      </div>
      <ArrowRight className="h-4 w-4 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" />
    </Link>
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

function DetailedSnapshotMetrics({ summary, isFetching }) {
  return (
    <details className="rounded-xl border border-slate-800 bg-slate-900/55 text-slate-100">
      <summary className="cursor-pointer px-3 py-3 text-xs font-black uppercase tracking-wider text-slate-200">
        Detailed dashboard counts
      </summary>
      <div className="space-y-4 border-t border-slate-800 px-3 py-3">
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
          <SnapshotMetricCard label="Unscheduled" value={summary.delivery?.unscheduled} tone="warning" />
          <SnapshotMetricCard label="Completed In Range" value={summary.delivery?.completed_in_range} tone="success" />
        </SnapshotGroup>

        <SnapshotGroup title="Inventory Setup" description="Diagnostic stock references only until inventory policy is approved">
          <SnapshotMetricCard icon={AlertTriangle} label="Low" value={summary.inventory?.low} tone="warning" />
          <SnapshotMetricCard label="Critical" value={summary.inventory?.critical} tone="warning" />
          <SnapshotMetricCard label="Out Of Stock" value={summary.inventory?.out_of_stock} tone="warning" />
        </SnapshotGroup>

        <SnapshotGroup title="Alerts" description="Active sanitized ops alerts">
          <SnapshotMetricCard icon={Bell} label="Active" value={summary.alerts?.active} />
          <SnapshotMetricCard label="Critical" value={summary.alerts?.critical} tone="danger" />
          <SnapshotMetricCard label="Warning" value={summary.alerts?.warning} tone="warning" />
          <SnapshotMetricCard label="Info" value={summary.alerts?.info} tone="info" />
        </SnapshotGroup>

        <SnapshotGroup title="Operational Health" description="Review queue and command-history signals">
          <SnapshotMetricCard icon={ShieldCheck} label="Open Reviews" value={summary.ops_health?.review_open} tone={Number(summary.ops_health?.review_open || 0) > 0 ? 'warning' : 'success'} />
          <SnapshotMetricCard label="Failed Commands" value={summary.ops_health?.command_failed} tone={Number(summary.ops_health?.command_failed || 0) > 0 ? 'danger' : 'success'} />
          <SnapshotMetricCard label="Rejected Commands" value={summary.ops_health?.command_rejected} tone={Number(summary.ops_health?.command_rejected || 0) > 0 ? 'warning' : 'success'} />
          <SnapshotMetricCard label="Pending / Running" value={summary.ops_health?.command_running} tone={Number(summary.ops_health?.command_running || 0) > 0 ? 'warning' : 'success'} />
        </SnapshotGroup>

        <SnapshotGroup title="Source Mix" description="Aggregate order source counts">
          <SnapshotMetricCard icon={BarChart3} label="One-Time" value={summary.source_mix?.one_time} />
          <SnapshotMetricCard label="Subscription" value={summary.source_mix?.subscription} />
          <SnapshotMetricCard label="POS" value={summary.source_mix?.pos} />
          <SnapshotMetricCard label="Other" value={summary.source_mix?.other} />
        </SnapshotGroup>
      </div>
    </details>
  );
}

function OperationsSnapshot({ user }) {
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisibility();
  const today = todayDate();
  const [preset, setPreset] = useState('today');
  const [customRangeOpen, setCustomRangeOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [appliedDateFrom, setAppliedDateFrom] = useState(today);
  const [appliedDateTo, setAppliedDateTo] = useState(today);
  const isCustom = preset === 'custom';
  const showCustomRange = customRangeOpen || isCustom;
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

  useEffect(() => {
    if (!isAdminUser(user) || !isPageVisible) return;
    queryClient.invalidateQueries({ queryKey: ['admin-operations-dashboard-summary'] });
  }, [isPageVisible, queryClient, user]);

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
    summary.delivery?.unscheduled,
    summary.ops_health?.review_open,
    summary.ops_health?.command_failed,
    summary.ops_health?.command_rejected,
    summary.ops_health?.command_running,
    summary.inventory?.low,
    summary.alerts?.active,
  ].every(value => Number(value || 0) === 0);
  const priorityActions = buildPriorityActions(summary);

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-950 p-4 space-y-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-black text-white">Operations Snapshot</h2>
            <span className="rounded-full border border-cyan-500 bg-cyan-600 px-2 py-0.5 text-[10px] font-black text-white">
              Live read
            </span>
            <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-black text-slate-200">
              30s refresh
            </span>
          </div>
          <p className="text-xs font-medium text-slate-300 mt-0.5">
            {isNativeFallback ? 'Native Customer App fallback summary' : 'Operations summary'}
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
              setCustomRangeOpen(false);
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
        <button
          type="button"
          onClick={() => {
            setCustomRangeOpen(true);
            setPreset('custom');
          }}
          className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
            isCustom
              ? 'bg-emerald-500 text-emerald-950 border-emerald-400'
              : 'bg-slate-900 text-slate-300 border-slate-700 hover:border-emerald-500 hover:text-white'
          }`}
        >
          Custom Range
        </button>
      </div>

      {showCustomRange && (
        <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/65 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 font-black">Custom From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => {
                  setDateFrom(event.target.value);
                }}
                className="w-full h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
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
                className="w-full h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white"
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
                  : isCustom && appliedDateFrom === dateFrom && appliedDateTo === dateTo
                    ? 'bg-emerald-500 text-emerald-950 border-emerald-400'
                    : 'bg-slate-950 text-slate-300 border-slate-700 hover:border-emerald-500 hover:text-white'
              }`}
            >
              Apply Custom Range
            </button>
          </div>

          {rangeError && (
            <div className="rounded-lg border border-cyan-900/70 bg-cyan-950/40 p-3 text-xs text-cyan-100">
              {rangeError}
            </div>
          )}
        </div>
      )}

      {showError && (
        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">
          {error?.message || 'Unable to load operations snapshot.'}
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

          <OperationsPulse summary={summary} />

          <OpsHealthContext summary={summary} />

          <TodayRunway summary={summary} />

          <section className="space-y-2">
            <div>
              <h3 className="text-xs font-bold text-white">Next Actions</h3>
              <p className="mt-0.5 text-[10px] text-slate-400">The highest-signal places to check from the current operations summary.</p>
            </div>
            {priorityActions.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {priorityActions.map(action => (
                  <PriorityAction key={action.route} action={action} />
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-xs font-semibold text-slate-300">
                No immediate action surfaced for this range.
              </div>
            )}
          </section>

          <DataNotes data={data} warnings={warnings} />

          <DetailedSnapshotMetrics summary={summary} isFetching={isFetching} />
        </div>
      )}
    </section>
  );
}

function tileGradient(title) {
  const key = title.toLowerCase();
  if (key.includes('admin order')) return 'from-sky-500 to-blue-700';
  if (key.includes('pos') || key.includes('event')) return 'from-fuchsia-500 to-purple-700';
  if (key.includes('shopify')) return 'from-green-500 to-emerald-700';
  if (key.includes('live checkout')) return 'from-cyan-500 to-teal-700';
  if (key.includes('production queue')) return 'from-lime-500 to-emerald-700';
  if (key.includes('production planning')) return 'from-yellow-500 to-orange-600';
  if (key.includes('inventory')) return 'from-rose-500 to-red-700';
  if (key.includes('compliance')) return 'from-violet-500 to-purple-700';
  if (key.includes('route ops')) return 'from-teal-500 to-emerald-700';
  if (key.includes('delivery')) return 'from-emerald-500 to-green-700';
  if (key.includes('calendar')) return 'from-cyan-500 to-blue-600';
  if (key.includes('events')) return 'from-fuchsia-500 to-purple-700';
  if (key.includes('purchase')) return 'from-amber-500 to-orange-700';
  if (key.includes('suppliers')) return 'from-lime-500 to-green-700';
  if (key.includes('reporting')) return 'from-blue-500 to-indigo-700';
  if (key.includes('review')) return 'from-cyan-500 to-blue-700';
  if (key.includes('audit')) return 'from-slate-500 to-zinc-700';
  if (key.includes('resources')) return 'from-indigo-500 to-blue-700';
  if (key.includes('product image')) return 'from-pink-500 to-rose-600';
  if (key.includes('ops alert')) return 'from-red-500 to-rose-700';
  if (key.includes('sync health')) return 'from-violet-500 to-indigo-700';
  if (key.includes('sync status')) return 'from-slate-500 to-slate-700';
  if (key.includes('loyalty')) return 'from-amber-500 to-yellow-600';
  if (key.includes('bag return')) return 'from-teal-500 to-cyan-700';
  if (key.includes('notifications')) return 'from-orange-500 to-red-600';
  return 'from-slate-500 to-slate-700';
}

function AppIconTile({ card }) {
  const Icon = card.icon;
  const gradient = tileGradient(card.title);
  return (
    <Link to={card.route} className="flex flex-col items-center gap-1.5 active:scale-90 transition-transform">
      <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradient} flex items-center justify-center shadow-md`}>
        <Icon className="w-7 h-7 text-white" />
      </div>
      <span className="text-[10px] font-semibold text-center text-foreground leading-tight max-w-[72px] line-clamp-2">{card.title}</span>
    </Link>
  );
}

function AppIconSection({ section }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-black uppercase tracking-wider text-muted-foreground">{section.title}</h2>
        <div className="flex-1 h-px bg-border/50" />
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-x-3 gap-y-4">
        {section.cards.map(card => (
          <AppIconTile key={card.route} card={card} />
        ))}
      </div>
    </section>
  );
}

function OperationsToolMap() {
  const primarySections = sections.slice(0, 3);
  const secondarySections = sections.slice(3);

  return (
    <section className="space-y-5">
      <div>
        <h2 className="text-sm font-black text-foreground">Admin Tools</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">The core workspace for orders, production, compliance, and fulfillment.</p>
      </div>
      {primarySections.map(section => (
        <AppIconSection key={section.title} section={section} />
      ))}

      <details className="rounded-xl border border-border/60 bg-card/70">
        <summary className="cursor-pointer px-3 py-3 text-xs font-black uppercase tracking-wider text-muted-foreground">
          More admin tools
        </summary>
        <div className="space-y-5 border-t border-border/60 px-3 py-4">
          {secondarySections.map(section => (
            <AppIconSection key={section.title} section={section} />
          ))}
        </div>
      </details>
    </section>
  );
}

export default function Operations() {
  const { user } = useAuth();

  if (!isAdminUser(user)) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-6 md:pb-10">
      <AdminOpsHeader
        title="Operations"
        subtitle="Customer App admin tools"
        badge="Admin-only"
        badgeTone="native"
        backTo="/account"
        actions={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      />

      <div className="mx-auto mt-4 w-full max-w-[1180px] space-y-5 px-4">
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-950 p-3 shadow-sm">
          <p className="text-xs font-black text-white">Customer App operations console</p>
          <p className="text-[10px] font-medium text-emerald-100 mt-0.5">
            Live admin workspace for production, compliance, fulfillment, catalog, notifications, and source-backed visibility.
          </p>
          <AdminStatusLegend className="mt-2" showHubFallback={false} />
        </div>

        <OperationsSnapshot user={user} />

        <OperationsToolMap />
      </div>
    </div>
  );
}
