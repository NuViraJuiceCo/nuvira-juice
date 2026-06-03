import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  CalendarDays,
  CheckCircle,
  MapPin,
  Package,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Store,
  UserRound,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import May30ReadinessPanel from '@/components/admin/May30ReadinessPanel';
import May30EventStockPlanPanel from '@/components/admin/May30EventStockPlanPanel';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
];

const posReadinessItems = [
  {
    label: 'Event source labeling',
    status: 'ready',
    detail: 'Cards label POS/event rows separately from app delivery orders and show Hub plus native mirror counts.',
  },
  {
    label: 'No delivery blocker',
    status: 'ready',
    detail: 'POS rows are expected to stay fulfilled and outside delivery queues; delivery/task flags are surfaced as exceptions.',
  },
  {
    label: 'Production impact',
    status: 'watch',
    detail: 'Event sales should not auto-create delivery production work. Any production flag is highlighted for immediate admin review.',
  },
  {
    label: 'Fallback',
    status: 'fallback',
    detail: 'Official Shopify POS ingestion remains Hub-backed while Customer App visibility is proven.',
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

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
}

function formatDate(value) {
  if (!value) return 'Date pending';
  const datePart = value.slice(0, 10);
  const [year, month, day] = datePart.split('-').map(Number);
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

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '--';
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function SummaryCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    success: 'border-emerald-100 bg-emerald-50/60',
    warning: 'border-cyan-100 bg-cyan-50/60',
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

function rangeForPreset(preset, today, appliedDateFrom, appliedDateTo) {
  if (preset === 'custom') return { date_from: appliedDateFrom, date_to: appliedDateTo };
  if (preset === 'today') return { date_from: today, date_to: today };
  if (preset === 'last_30_days') return { date_from: addDays(today, -29), date_to: today };
  return { date_from: addDays(today, -6), date_to: today };
}

function Badge({ children, tone = 'default' }) {
  const mappedTone = tone === 'success' ? 'source' : tone === 'danger' ? 'danger' : tone === 'warning' ? 'warning' : 'neutral';
  return <AdminStatusPill label={children} tone={mappedTone} />;
}

function profileBlockerLabel(blocker) {
  return {
    missing_customer_email: 'email not captured',
    invalid_customer_email: 'invalid email',
    placeholder_customer_email: 'placeholder email',
  }[blocker] || 'profile blocked';
}

function OrderCard({ order }) {
  const hasUnexpectedOpsWork = order.requires_delivery || order.requires_production || order.requires_fulfillment_task;
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];

  return (
    <article className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-sm font-bold text-foreground">{order.order_number || 'POS order'}</h2>
            <Badge tone="success">POS / event</Badge>
            <Badge tone={hasUnexpectedOpsWork ? 'danger' : 'default'}>
              {hasUnexpectedOpsWork ? 'ops work flagged' : 'no delivery or production'}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            {order.customer_name || 'Walk-in Customer'}
            {order.customer_email ? ` · ${order.customer_email}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-foreground">{formatMoney(order.total_price)}</p>
          <p className="text-[10px] text-muted-foreground">{formatNumber(order.item_count)} items</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Payment</p>
          <AdminStatusPill value={order.payment_status} size="md" />
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Fulfillment</p>
          <AdminStatusPill value={order.fulfillment_status} size="md" />
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Production</p>
          <AdminStatusPill value={order.production_status} size="md" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarDays className="w-3.5 h-3.5" />
          {formatDate(order.customer_order_date || order.created_date)}
        </span>
        {order.location_label && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5" />
            {order.location_label}
          </span>
        )}
      </div>

      {lineItems.length > 0 && (
        <div className="rounded-lg border border-border/50 bg-background p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Items</p>
          <div className="space-y-2">
            {lineItems.map((item, index) => (
              <div key={`${item.title || 'item'}-${index}`} className="flex justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{item.title || 'Item'}</p>
                  <p className="text-[10px] text-muted-foreground truncate">
                    {[item.variant_title, item.sku ? `SKU ${item.sku}` : null].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-foreground">x{formatNumber(item.quantity)}</p>
                  {item.price !== null && item.price !== undefined && (
                    <p className="text-[10px] text-muted-foreground">{formatMoney(item.price)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {order.internal_note_summary && (
        <div className="rounded-lg border border-border/50 bg-background p-3">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">Hub Note Summary</p>
          <p className="text-xs text-foreground leading-relaxed">{order.internal_note_summary}</p>
        </div>
      )}
    </article>
  );
}

export default function POSOrders() {
  const { user } = useAuth();
  const today = todayDate();
  const [preset, setPreset] = useState('last_7_days');
  const [dateFrom, setDateFrom] = useState(addDays(today, -6));
  const [dateTo, setDateTo] = useState(today);
  const [appliedDateFrom, setAppliedDateFrom] = useState(addDays(today, -6));
  const [appliedDateTo, setAppliedDateTo] = useState(today);
  const isCustom = preset === 'custom';
  const rangeError = validateRange(dateFrom, dateTo);
  const profilePreviewRange = useMemo(
    () => rangeForPreset(preset, today, appliedDateFrom, appliedDateTo),
    [appliedDateFrom, appliedDateTo, preset, today],
  );
  const profilePreviewPreset = isCustom ? 'custom' : preset;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-pos-orders-summary', preset, appliedDateFrom, appliedDateTo],
    queryFn: async () => {
      const payload = isCustom
        ? { preset: 'custom', date_from: appliedDateFrom, date_to: appliedDateTo, limit: 100 }
        : { preset, limit: 100 };
      const res = await base44.functions.invoke('getAdminPOSOrdersSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { orders: [], summary: {} };
    },
    enabled: user?.role === 'admin',
    staleTime: 30000,
  });

  const {
    data: profilePreview,
    isLoading: isProfilePreviewLoading,
    isError: isProfilePreviewError,
    error: profilePreviewError,
    isFetching: isProfilePreviewFetching,
  } = useQuery({
    queryKey: ['admin-may30-pos-profile-candidates', profilePreviewPreset, profilePreviewRange.date_from, profilePreviewRange.date_to],
    queryFn: async () => {
      const res = await base44.functions.invoke('previewAdminMay30POSProfileCandidates', {
        preset: profilePreviewPreset,
        date_from: profilePreviewRange.date_from,
        date_to: profilePreviewRange.date_to,
        limit: 100,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { candidates: [], blocked_orders: [] };
    },
    enabled: user?.role === 'admin',
    staleTime: 30000,
  });

  const orders = Array.isArray(data?.orders) ? data.orders : [];
  const summary = data?.summary || {};
  const profileCandidates = Array.isArray(profilePreview?.candidates) ? profilePreview.candidates : [];
  const profileBlockedOrders = Array.isArray(profilePreview?.blocked_orders) ? profilePreview.blocked_orders : [];
  const profileCandidatePreview = profileCandidates
    .filter(candidate => candidate.would_create_starter_profile || candidate.profile_status === 'already_profile')
    .slice(0, 6);
  const starterCandidateSublabel = [
    `${formatNumber(profilePreview?.named_starter_profile_count || 0)} named`,
    `${formatNumber(profilePreview?.email_only_starter_profile_count || 0)} email-only`,
  ].join(' · ');
  const contextLabel = useMemo(() => {
    if (data?.date_from && data?.date_to) {
      return `${formatDate(data.date_from)} - ${formatDate(data.date_to)}`;
    }
    if (isCustom) return `${formatDate(appliedDateFrom)} - ${formatDate(appliedDateTo)}`;
    return presetOptions.find(option => option.value === preset)?.label || 'Last 7 Days';
  }, [appliedDateFrom, appliedDateTo, data?.date_from, data?.date_to, isCustom, preset]);

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
        title="POS / Event Orders"
        subtitle="Read-only Hub-backed sales view"
        badge="Admin-only"
        badgeTone="native"
        actions={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
      />

      <div className="px-4 mt-4 space-y-4">
        <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-foreground">Event Sales Snapshot</h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground border border-border/50">
                  Hub + Native mirror
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">POS orders should stay paid, fulfilled, and out of production/delivery queues.</p>
              <p className="text-[10px] text-muted-foreground mt-1">
                Hub rows: {data?.hub_count ?? 0} · Native Customer App rows: {data?.native_count ?? 0}
              </p>
              <AdminStatusLegend className="mt-2" />
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
                    ? 'bg-nuvira-gradient text-white border-primary'
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
                onChange={(event) => setDateFrom(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom To</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
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
                    ? 'bg-nuvira-gradient text-white border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
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

          {isError && (
            <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-700">
              {error?.message || 'Unable to load POS orders.'}
            </div>
          )}

          {data?.truncated && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
              Hub returned a bounded order list. Narrow the date range if you need exact row-level review.
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <SummaryCard icon={Store} label="POS Orders" value={summary.total} isRefreshing={isFetching} />
            <SummaryCard icon={CheckCircle} label="Paid" value={summary.paid} tone="success" />
            <SummaryCard label="Fulfilled" value={summary.fulfilled} tone="success" />
            <SummaryCard icon={Package} label="Prod Not Required" value={summary.production_not_required} />
            <SummaryCard label="Delivery Flags" value={summary.requires_delivery} tone={summary.requires_delivery ? 'danger' : 'default'} />
            <SummaryCard label="Production Flags" value={summary.requires_production} tone={summary.requires_production ? 'danger' : 'default'} />
            <SummaryCard label="Task Flags" value={summary.requires_fulfillment_task} tone={summary.requires_fulfillment_task ? 'danger' : 'default'} />
            <SummaryCard icon={ReceiptText} label="Shown" value={summary.shown ?? orders.length} />
          </div>
        </section>

        <May30ReadinessPanel
          title="POS / event readiness"
          description="Use this page during the event to verify POS orders are captured as event sales and not accidentally treated as delivery orders."
          items={posReadinessItems}
          actions={[
            { label: 'Admin Orders', to: '/admin/orders' },
            { label: 'Production Planning', to: '/admin/production-planning' },
            { label: 'Review / Sync Health', to: '/admin/sync-health' },
          ]}
        />

        <May30EventStockPlanPanel />

        <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <UserRound className={`w-4 h-4 text-primary ${isProfilePreviewFetching ? 'animate-pulse' : ''}`} />
                <h2 className="text-sm font-bold text-foreground">Customer profile readiness</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Read-only preview of POS buyers who could receive starter profiles before they download the app.
              </p>
              <p className="text-[10px] text-muted-foreground mt-1">
                No profiles are created from this page. Customers still complete onboarding themselves.
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Preview Range</p>
              <p className="text-xs font-semibold text-foreground">
                {formatDate(profilePreviewRange.date_from)} - {formatDate(profilePreviewRange.date_to)}
              </p>
            </div>
          </div>

          {isProfilePreviewError && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
              Profile candidate preview unavailable: {profilePreviewError?.message || 'Unknown error'}
            </div>
          )}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <SummaryCard
              icon={UserRound}
              label="Starter Candidates"
              value={profilePreview?.would_create_starter_profile_count || 0}
              sublabel={starterCandidateSublabel}
              tone={(profilePreview?.would_create_starter_profile_count || 0) > 0 ? 'success' : 'default'}
              isRefreshing={isProfilePreviewLoading || isProfilePreviewFetching}
            />
            <SummaryCard label="Already Profiles" value={profilePreview?.already_profile_count || 0} />
            <SummaryCard label="Blocked Candidates" value={profilePreview?.blocked_candidate_count || 0} tone={(profilePreview?.blocked_candidate_count || 0) > 0 ? 'warning' : 'default'} />
            <SummaryCard label="Blocked Orders" value={profilePreview?.blocked_order_count || 0} tone={(profilePreview?.blocked_order_count || 0) > 0 ? 'warning' : 'default'} />
          </div>

          {profileCandidatePreview.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Profile rows to review</p>
              {profileCandidatePreview.map(candidate => (
                <div
                  key={`${candidate.customer_email}-${candidate.profile_status}`}
                  className="flex items-start justify-between gap-3 border-t border-border/50 first:border-t-0 pt-2 first:pt-0"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground truncate">
                      {candidate.customer_name && candidate.starter_profile_mode !== 'email_only'
                        ? candidate.customer_name
                        : candidate.customer_email}
                    </p>
                    <p className="text-[10px] text-muted-foreground truncate">{candidate.customer_email}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      Orders: {(candidate.order_numbers || []).join(', ') || 'none'}
                    </p>
                    {candidate.name_completion_required && (
                      <p className="text-[10px] text-cyan-700 truncate">Name will be completed during onboarding.</p>
                    )}
                  </div>
                  <AdminStatusPill
                    label={candidate.would_create_starter_profile
                      ? candidate.starter_profile_mode === 'email_only'
                        ? 'email-only ready'
                        : 'starter ready'
                      : 'already profile'}
                    tone={candidate.would_create_starter_profile ? 'success' : 'neutral'}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}

          {profileBlockedOrders.length > 0 && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-cyan-900 font-semibold">Needs email follow-up</p>
                  <p className="text-xs text-cyan-800 mt-1">
                    These POS orders cannot receive starter profiles because no usable customer email was captured.
                  </p>
                </div>
                <AdminStatusPill label={`${profileBlockedOrders.length} orders`} tone="warning" size="sm" />
              </div>
              <div className="space-y-2">
                {profileBlockedOrders.slice(0, 12).map((order, index) => (
                  <div
                    key={`${order.order_number || 'blocked'}-${index}`}
                    className="flex items-start justify-between gap-3 border-t border-cyan-200 first:border-t-0 pt-2 first:pt-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-cyan-950 truncate">
                        {order.order_number || 'POS order'}
                        {order.customer_name ? ` · ${order.customer_name}` : ''}
                      </p>
                      <p className="text-[10px] text-cyan-800 truncate">
                        {[order.customer_order_date ? formatDate(order.customer_order_date) : null, order.customer_email || null, order.source_record ? `source ${order.source_record}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <AdminStatusPill label={profileBlockerLabel(order.blocker)} tone="warning" size="sm" />
                      {order.total_price !== null && order.total_price !== undefined && (
                        <p className="text-[10px] text-cyan-800 mt-1">{formatMoney(order.total_price)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {profileBlockedOrders.length > 12 && (
                <p className="text-[10px] text-cyan-800">
                  Showing 12 of {profileBlockedOrders.length}. Narrow the date range for focused review.
                </p>
              )}
            </div>
          )}

          {Array.isArray(profilePreview?.warnings) && profilePreview.warnings.length > 0 && (
            <div className="rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-800">
              Warnings: {profilePreview.warnings.join(', ')}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">Orders</h2>
              <p className="text-xs text-muted-foreground">{orders.length} Hub POS orders shown</p>
            </div>
            {isFetching && <RefreshCw className="w-4 h-4 text-primary animate-spin" />}
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="h-32 rounded-xl border border-border/50 bg-muted/40 animate-pulse" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-xl border border-border/50 bg-card p-6 text-center">
              <Store className="w-7 h-7 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm font-semibold text-foreground">No POS orders found for this range.</p>
              <p className="text-xs text-muted-foreground mt-1">Try Last 30 Days or confirm Shopify POS ingestion in Hub.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {orders.map(order => (
                <OrderCard key={order.id || order.order_number} order={order} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
